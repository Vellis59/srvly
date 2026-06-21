/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push("ssh2");
      } else if (typeof config.externals === "function") {
        const origExternals = config.externals;
        config.externals = (ctx, callback) => {
          if (ctx.request === "ssh2") return callback(null, true);
          return origExternals(ctx, callback);
        };
      }
    }
    return config;
  },
};

module.exports = nextConfig;
