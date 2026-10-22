// Production serving also works on Windows, without shell-specific env syntax.
process.env.NODE_ENV = 'production';
await import('../dist/server/main.js');
