-- Migration: Add unique constraint on installations(server_id, recipe_id)
-- This prevents duplicate installations of the same app on the same server.
-- Previous code always INSERTed a new record instead of UPDATE-ing existing one,
-- causing duplicate entries when the agent redeployed or modified an app.

-- Step 1: Remove duplicates, keeping only the newest row per (server_id, recipe_id)
DELETE FROM installations
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY server_id, recipe_id
      ORDER BY created_at DESC
    ) AS rn
    FROM installations
  ) AS ranked
  WHERE ranked.rn > 1
);

-- Step 2: Add unique constraint
ALTER TABLE installations
ADD CONSTRAINT installations_server_id_recipe_id_key UNIQUE (server_id, recipe_id);
