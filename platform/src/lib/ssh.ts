import { exec } from "child_process";
import { db } from "@/server/db";
import { servers } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import os from "os";

type ExecResult = {
  success: boolean;
  output: string;
  error?: string;
};

/**
 * Execute a command on a remote server via SSH (system ssh binary).
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
    return { success: false, output: "", error: "Server not found" };
  }
  if (!server.sshPrivateKey || !server.ip) {
    return {
      success: false,
      output: "",
      error: "No SSH key or IP configured for this server",
    };
  }

  return executeRaw(server.ip, server.sshPrivateKey, script, timeout);
}

/**
 * Execute a command via raw SSH (system ssh binary).
 */
export async function executeRaw(
  host: string,
  privateKey: string,
  script: string,
  timeout = 60,
): Promise<ExecResult> {
  // Validate host to prevent command injection
  const hostRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,6}$|^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$|^[a-fA-F0-9:]+$/;
  if (!hostRegex.test(host)) {
    return { success: false, output: "", error: "Invalid host address format" };
  }

  // Write key to a temp file with secure permissions
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "srvly-ssh-"));
  const keyPath = path.join(tmpDir, "id_rsa");
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });

  // Write script to a temp file
  const scriptPath = path.join(tmpDir, "script.sh");
  fs.writeFileSync(scriptPath, script, { mode: 0o700 });

  return new Promise((resolve) => {
    const cmd = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -i "${keyPath}" root@${host} "bash -s" < "${scriptPath}"`;

    exec(
      cmd,
      {
        timeout: timeout * 1000,
        maxBuffer: 5 * 1024 * 1024, // 5MB
      },
      (error, stdout, stderr) => {
        // Cleanup temp files
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}

        if (error && !stdout) {
          resolve({
            success: false,
            output: stdout || "",
            error: (stderr || error.message || "").slice(0, 2000),
          });
          return;
        }

        resolve({
          success: true,
          output: truncateOutput(stdout || ""),
          error: stderr ? truncateOutput(stderr) : undefined,
        });
      },
    );
  });
}

function truncateOutput(s: string, maxLen = 50000): string {
  if (s.length <= maxLen) return s;
  return (
    s.slice(0, maxLen) +
    "\n\n... [Truncated: " +
    (s.length - maxLen) +
    " extra characters]"
  );
}
