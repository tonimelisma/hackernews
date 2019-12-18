const unknownEndpoint = (req, res, next) => {
  res.status(404).send({ error: "unknown endpoint " });
};

const errorHandler = (error, req, res, next) => {
  console.log("error! ", error);

  // if(error.name === "XXXError" && error.kind === "ObjectId")

  res.status(500).json({ error: error.message });

  next(error);
};

module.exports = {
  unknownEndpoint,
  errorHandler
};
