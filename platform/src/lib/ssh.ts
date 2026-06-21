import { Client } from "ssh2";
import { db } from "@/server/db";
import { servers } from "@/server/db/schema";
import { eq } from "drizzle-orm";

type ExecResult = {
  success: boolean;
  output: string;
  error?: string;
};

/**
 * Execute a command on a remote server via SSH.
 * Looks up the server's SSH key from the DB.
 */
export async function executeOnServer(
  serverId: string,
  script: string,
  timeout = 60,
): Promise<ExecResult> {
  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);

  if (!server) {
    return { success: false, output: "", error: "Serveur introuvable" };
  }
  if (!server.sshPrivateKey || !server.ip) {
    return { success: false, output: "", error: "Aucune clé SSH ou IP configurée pour ce serveur" };
  }

  return executeRaw(server.ip, server.sshPrivateKey, script, timeout);
}

/**
 * Execute a command via raw SSH connection.
 */
export async function executeRaw(
  host: string,
  privateKey: string,
  script: string,
  timeout = 60,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const conn = new Client();
    let output = "";
    let errorOutput = "";
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        conn.end();
        resolve({
          success: false,
          output,
          error: "Timeout: la commande a dépassé " + timeout + " secondes",
        });
      }
    }, timeout * 1000);

    conn.on("ready", () => {
      conn.exec(script, { pty: false }, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          done = true;
          conn.end();
          resolve({ success: false, output, error: err.message });
          return;
        }

        stream.on("data", (data: Buffer) => {
          output += data.toString("utf-8");
        });

        stream.stderr.on("data", (data: Buffer) => {
          errorOutput += data.toString("utf-8");
        });

        stream.on("close", (code: number | null) => {
          clearTimeout(timer);
          done = true;
          conn.end();
          resolve({
            success: code === 0 || code === null,
            output: truncateOutput(output),
            error: errorOutput ? truncateOutput(errorOutput) : undefined,
          });
        });
      });
    });

    conn.on("error", (err) => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        resolve({ success: false, output, error: err.message });
      }
    });

    conn.connect({
      host,
      username: "root",
      privateKey,
      readyTimeout: 10000,
      keepaliveInterval: 10000,
    });
  });
}

function truncateOutput(s: string, maxLen = 50000): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\n\n... [Tronqué: " + (s.length - maxLen) + " caractères supplémentaires]";
}
