const unknownEndpoint = (req, res, next) => {
  res.status(404).send({ error: "unknown endpoint" });
};

const errorHandler = (error, req, res, next) => {
  console.error("unhandled error:", error);

  res.status(500).json({ error: error.message });
};

module.exports = {
  unknownEndpoint,
  errorHandler
};
