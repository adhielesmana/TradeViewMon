import bcrypt from "bcryptjs";
import { db } from "./db";
import { users, type User, type SafeUser } from "@shared/schema";
import { eq } from "drizzle-orm";

const SALT_ROUNDS = 10;

const SUPERADMIN_USERNAME = "adhielesmana";
const SUPERADMIN_PASSWORD = "admin123";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export async function createUser(username: string, password: string, role: string = "user", email?: string): Promise<SafeUser> {
  const hashedPassword = await hashPassword(password);
  
  // Superadmins and admins are auto-approved, regular users need approval
  const approvalStatus = (role === "superadmin" || role === "admin") ? "approved" : "pending";
  
  const [newUser] = await db.insert(users).values({
    username,
    password: hashedPassword,
    role,
    email: email || null,
    approvalStatus,
    approvedAt: approvalStatus === "approved" ? new Date() : null,
  }).returning();

  const { password: _, ...safeUser } = newUser;
  return safeUser;
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.username, username));
  return user;
}

export async function findUserById(id: string): Promise<SafeUser | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) return undefined;
  
  const { password: _, ...safeUser } = user;
  return safeUser;
}

export async function authenticateUser(username: string, password: string): Promise<SafeUser | null> {
  const user = await findUserByUsername(username);
  if (!user) return null;

  const isValid = await verifyPassword(password, user.password);
  if (!isValid) return null;

  await db.update(users)
    .set({ lastLogin: new Date() })
    .where(eq(users.id, user.id));

  const { password: _, ...safeUser } = user;
  return safeUser;
}

export async function seedSuperadmin(): Promise<void> {
  const existingAdmin = await findUserByUsername(SUPERADMIN_USERNAME);
  
  if (!existingAdmin) {
    console.log("Creating superadmin user...");
    await createUser(SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD, "superadmin");
    console.log("Superadmin created successfully");
  } else {
    console.log("Superadmin already exists, ensuring correct password and role...");
    const hashedPassword = await hashPassword(SUPERADMIN_PASSWORD);
    await db.update(users)
      .set({ 
        role: "superadmin",
        password: hashedPassword,
        approvalStatus: "approved"
      })
      .where(eq(users.id, existingAdmin.id));
    console.log("Superadmin password and role verified");
  }
}

// Seed dummy test users for demo trading testing (DEVELOPMENT ONLY)
const TEST_USERS = [
  { username: "testuser", password: "test123", role: "user" },
  { username: "demotrader", password: "demo123", role: "user" },
];

export async function seedTestUsers(): Promise<void> {
  // Only seed test users in development environment
  if (process.env.NODE_ENV === "production") {
    console.log("Skipping test user seeding in production environment");
    return;
  }
  
  for (const testUser of TEST_USERS) {
    const existingUser = await findUserByUsername(testUser.username);
    
    if (!existingUser) {
      console.log(`Creating test user: ${testUser.username}...`);
      await createUser(testUser.username, testUser.password, testUser.role);
      console.log(`Test user ${testUser.username} created successfully`);
    } else {
      console.log(`Test user ${testUser.username} already exists`);
    }
  }
}

export function getSafeUser(user: User): SafeUser {
  const { password: _, ...safeUser } = user;
  return safeUser;
}
