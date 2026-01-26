import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

// Check if running on Replit (has sidecar service)
const isReplit = !!process.env.REPL_ID;

// Local uploads directory for self-hosted deployments
const LOCAL_UPLOADS_DIR = path.join(process.cwd(), "uploads");

// Ensure uploads directory exists for self-hosted
if (!isReplit) {
  if (!fs.existsSync(LOCAL_UPLOADS_DIR)) {
    fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
    console.log("[Upload] Created local uploads directory:", LOCAL_UPLOADS_DIR);
  }
}

// Configure multer for local file uploads (self-hosted)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, LOCAL_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueId = randomUUID();
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${uniqueId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

/**
 * Register object storage routes for file uploads.
 * Supports both Replit Object Storage and local disk storage for self-hosted.
 */
export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = isReplit ? new ObjectStorageService() : null;

  console.log(`[Upload] Mode: ${isReplit ? "Replit Object Storage" : "Local Disk Storage"}`);

  if (isReplit && objectStorageService) {
    // Replit mode: use presigned URL flow
    app.post("/api/uploads/request-url", async (req, res) => {
      try {
        const { name, size, contentType } = req.body;
        console.log("[Upload] Request received:", { name, size, contentType });

        if (!name) {
          return res.status(400).json({
            error: "Missing required field: name",
          });
        }

        console.log("[Upload] Getting presigned URL...");
        const uploadURL = await objectStorageService.getObjectEntityUploadURL();
        console.log("[Upload] Got presigned URL, normalizing path...");

        const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
        console.log("[Upload] Object path:", objectPath);

        res.json({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        });
      } catch (error: any) {
        console.error("[Upload] Error generating upload URL:", error?.message || error);
        res.status(500).json({ 
          error: "Failed to generate upload URL",
          details: error?.message || "Unknown error"
        });
      }
    });

    // Serve objects from Replit Object Storage
    app.get("/objects/:objectPath(*)", async (req, res) => {
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(req.path);
        // Cache images for 1 day (86400 seconds), other files for 1 hour
        const isImage = req.path.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/i);
        const cacheTtl = isImage ? 86400 : 3600;
        await objectStorageService.downloadObject(objectFile, res, cacheTtl);
      } catch (error) {
        console.error("Error serving object:", error);
        if (error instanceof ObjectNotFoundError) {
          return res.status(404).json({ error: "Object not found" });
        }
        return res.status(500).json({ error: "Failed to serve object" });
      }
    });
  } else {
    // Self-hosted mode: use local disk storage
    
    // For self-hosted, we need a direct upload endpoint
    app.post("/api/uploads/local", upload.single("file"), (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const objectPath = `/uploads/${req.file.filename}`;
        console.log("[Upload] Local file saved:", objectPath);

        res.json({
          objectPath,
          metadata: {
            name: req.file.originalname,
            size: req.file.size,
            contentType: req.file.mimetype,
          },
        });
      } catch (error: any) {
        console.error("[Upload] Local upload error:", error);
        res.status(500).json({ error: error?.message || "Upload failed" });
      }
    });

    // Fallback request-url endpoint for self-hosted (returns local upload URL)
    app.post("/api/uploads/request-url", (req, res) => {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Missing required field: name" });
      }
      
      // Tell client to use local upload endpoint
      res.json({
        useLocalUpload: true,
        uploadURL: "/api/uploads/local",
        message: "Self-hosted mode: use /api/uploads/local with multipart/form-data",
      });
    });

    // Serve uploaded files from local disk
    app.use("/uploads", (req, res, next) => {
      const filePath = path.join(LOCAL_UPLOADS_DIR, req.path);
      
      // Security: prevent directory traversal
      if (!filePath.startsWith(LOCAL_UPLOADS_DIR)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).json({ error: "File not found" });
      }
    });

    // Also handle /objects/ path for compatibility
    app.get("/objects/:objectPath(*)", (req, res) => {
      const objectPath = req.params.objectPath;
      // Map /objects/uploads/xxx to /uploads/xxx
      if (objectPath.startsWith("uploads/")) {
        const filename = objectPath.replace("uploads/", "");
        const filePath = path.join(LOCAL_UPLOADS_DIR, filename);
        
        if (!filePath.startsWith(LOCAL_UPLOADS_DIR)) {
          return res.status(403).json({ error: "Forbidden" });
        }
        
        if (fs.existsSync(filePath)) {
          res.sendFile(filePath);
        } else {
          res.status(404).json({ error: "File not found" });
        }
      } else {
        res.status(404).json({ error: "Object not found" });
      }
    });
  }
}

