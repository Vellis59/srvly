import { pgTable, text, timestamp, uuid, integer, jsonb, primaryKey } from "drizzle-orm/pg-core";
import type { AdapterAccount } from "next-auth/adapters";

// ─── Users (NextAuth-compatible) ───
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  apiToken: text("api_token").unique(),
  plan: text("plan").default("free").notNull(),
  maxServers: integer("max_servers").default(1).notNull(),
  webhookUrl: text("webhook_url"),
});

// ─── NextAuth adapter tables ───
export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

// ─── Servers (VPS membres) ───
export const servers = pgTable("servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  ip: text("ip").notNull(),
  os: text("os"),
  ram: integer("ram"),
  status: text("status").default("pending").notNull(),
  lastSeen: timestamp("last_seen"),
  sshPrivateKey: text("ssh_private_key"),
  sshPublicKey: text("ssh_public_key"),
  userSshKey: text("user_ssh_key"),
  systemInfo: jsonb("system_info"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Recipes / Catalogue ───
export const recipes = pgTable("recipes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version"),
  description: text("description"),
  category: text("category"),
  subcategory: text("subcategory"),
  icon: text("icon"),
  osSupport: text("os_support").array(),
  dependencies: text("dependencies").array(),
  params: jsonb("params"),
  recipe: jsonb("recipe"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Categories (user-defined, cross-server) ───
export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  icon: text("icon").default("📁"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Installations ───
export const installations = pgTable("installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  serverId: uuid("server_id").references(() => servers.id).notNull(),
  recipeId: text("recipe_id").references(() => recipes.id).notNull(),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  status: text("status").default("pending").notNull(),
  params: jsonb("params"),
  result: jsonb("result"),
  containers: jsonb("containers"),
  logs: text("logs"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Domains ───
export const domains = pgTable("domains", {
  id: uuid("id").defaultRandom().primaryKey(),
  serverId: uuid("server_id").references(() => servers.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  sslStatus: text("ssl_status").default("pending"),
  targetPort: integer("target_port"),
  targetApp: text("target_app"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Backups ───
export const backups = pgTable("backups", {
  id: uuid("id").defaultRandom().primaryKey(),
  serverId: uuid("server_id").references(() => servers.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").references(() => users.id).notNull(),
  installationId: uuid("installation_id").references(() => installations.id, { onDelete: "set null" }),
  type: text("type").notNull(), // 'volume' | 'postgres' | 'mysql' | 'mongodb' | 'redis'
  targetName: text("target_name").notNull(), // volume name / db name / container name
  filename: text("filename").notNull(), // local file path on the server
  sizeBytes: integer("size_bytes").default(0),
  status: text("status").default("running").notNull(), // running | success | failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
