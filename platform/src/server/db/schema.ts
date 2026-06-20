import { pgTable, text, timestamp, uuid, integer, jsonb } from "drizzle-orm/pg-core";

// ─── Users ───
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Servers (VPS membres) ───
export const servers = pgTable("servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  ip: text("ip").notNull(),
  os: text("os"),                        // détecté par l'agent
  ram: integer("ram"),                   // Mo
  status: text("status").default("pending").notNull(), // pending | connected | disconnected | error
  agentToken: text("agent_token").unique(),
  lastSeen: timestamp("last_seen"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Recipes / Catalogue ───
export const recipes = pgTable("recipes", {
  id: text("id").primaryKey(),           // "nginx", "nextcloud", etc.
  name: text("name").notNull(),
  version: text("version"),
  description: text("description"),
  category: text("category"),            // webserver, database, cms, etc.
  icon: text("icon"),
  osSupport: text("os_support").array(),
  dependencies: text("dependencies").array(),
  params: jsonb("params"),               // schéma des paramètres
  recipe: jsonb("recipe"),               // la recette YAML complète
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Installations ───
export const installations = pgTable("installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  serverId: uuid("server_id").references(() => servers.id).notNull(),
  recipeId: text("recipe_id").references(() => recipes.id).notNull(),
  status: text("status").default("pending").notNull(),
  // pending | running | success | failed
  params: jsonb("params"),               // paramètres utilisateur
  result: jsonb("result"),               // URL, admin, password, etc.
  logs: text("logs"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
