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
  agentToken: text("agent_token").unique(),
  lastSeen: timestamp("last_seen"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Recipes / Catalogue ───
export const recipes = pgTable("recipes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version"),
  description: text("description"),
  category: text("category"),
  icon: text("icon"),
  osSupport: text("os_support").array(),
  dependencies: text("dependencies").array(),
  params: jsonb("params"),
  recipe: jsonb("recipe"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Installations ───
export const installations = pgTable("installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  serverId: uuid("server_id").references(() => servers.id).notNull(),
  recipeId: text("recipe_id").references(() => recipes.id).notNull(),
  status: text("status").default("pending").notNull(),
  params: jsonb("params"),
  result: jsonb("result"),
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
