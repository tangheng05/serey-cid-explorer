// pm2 start ecosystem.config.cjs  ->  serves dist/ on port 8090.
// Point Nginx Proxy Manager's cid.serey.io host at this port. Rebuild with `npm run build`; no restart needed.
module.exports = {
  apps: [{
    name: 'cid-explorer',
    script: 'serve',
    env: {
      PM2_SERVE_PATH: './dist',
      PM2_SERVE_PORT: 8090,
      // Any path that is not a file gets index.html, so cid.serey.io/<cid> opens the page.
      PM2_SERVE_SPA: 'true',
      PM2_SERVE_HOMEPAGE: '/index.html',
    },
  }],
};
