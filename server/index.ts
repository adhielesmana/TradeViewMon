import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const isProduction = process.env.NODE_ENV === "production";

// Create PostgreSQL pool for session store
const sessionPool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Create session table if it doesn't exist
async function initSessionTable() {
  try {
    await sessionPool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);
    console.log("[Session] Session table ready");
  } catch (err) {
    console.error("[Session] Error creating session table:", err);
  }
}

// Initialize session table
initSessionTable();

const PgSession = connectPgSimple(session);

const app = express();
const httpServer = createServer(app);

// Trust proxy chain when behind Cloudflare/Nginx (for secure cookies over HTTPS)
// Use 'true' to trust all proxies in the chain, not just the first hop
if (isProduction) {
  app.set("trust proxy", true);
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// In production, check if HTTPS is being used
const useSecureCookies = isProduction && process.env.USE_HTTPS === "true";

console.log(`[Session] Environment: ${isProduction ? 'production' : 'development'}`);
console.log(`[Session] USE_HTTPS env: ${process.env.USE_HTTPS}`);
console.log(`[Session] Secure cookies: ${useSecureCookies}`);
console.log(`[Session] Using PostgreSQL session store`);

app.use(
  session({
    store: new PgSession({
      pool: sessionPool,
      tableName: "session",
      createTableIfMissing: false, // We create it ourselves above
      pruneSessionInterval: 60 * 15, // Prune every 15 minutes
    }),
    secret: process.env.SESSION_SECRET || "trady-secret-key-change-in-production",
    name: "trady.sid",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: useSecureCookies,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days for persistent login
      path: "/",
    },
  })
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);
      
      // Run image regeneration once on startup to update existing articles with Unsplash keyword-based URLs
      try {
        const { regenerateAllSnapshotImages } = await import("./news-service");
        const result = await regenerateAllSnapshotImages();
        if (result.updated > 0) {
          log(`Regenerated ${result.updated}/${result.total} article images with Unsplash keywords`);
        }
      } catch (error) {
        console.error("[Startup] Image regeneration failed:", error);
      }
    },
  );
})();
