declare module "ssh2" {
  import { EventEmitter } from "events";
  import { Duplex } from "stream";

  export interface ConnectConfig {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: string | Buffer;
    passphrase?: string;
    readyTimeout?: number;
    keepaliveInterval?: number;
    keepaliveCountMax?: number;
  }

  export interface ExecOptions {
    pty?: boolean | { term?: string; cols?: number; rows?: number };
    env?: NodeJS.ProcessEnv;
  }

  export class Client extends EventEmitter {
    connect(config: ConnectConfig): void;
    exec(
      command: string,
      options?: ExecOptions,
      callback?: (err: Error | undefined, stream: ClientChannel) => void
    ): void;
    end(): void;
    on(event: "ready", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "end", listener: () => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
  }

  export interface ClientChannel extends Duplex {
    stderr: Duplex;
    exitCode: number | null;
    on(event: "close", listener: (code: number | null) => void): this;
    on(event: "data", listener: (data: Buffer) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
  }
}
