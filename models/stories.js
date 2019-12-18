const mongoose = require("mongoose");

const storySchema = new mongoose.Schema({
  by: String,
  descendants: Number,
  id: { type: Number, unique: true },
  kids: [Number],
  score: Number,
  time: Date,
  title: String,
  type: String,
  url: String,
  updated: Date
});

module.exports = mongoose.model("Story", storySchema);
