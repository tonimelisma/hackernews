const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  by: String,
  id: Number,
  kids: [Number],
  parent: Number,
  text: String,
  time: Number,
  type: String
});

module.exports = mongoose.model("Comment", commentSchema);
