export default () => ({
  app: {
    port: parseInt(process.env.PORT ?? '3000', 10),
  },
});
