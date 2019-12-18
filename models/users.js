const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  username: String,
  hidden: [{ type: Number }]
});

module.exports = mongoose.model("User", userSchema);
