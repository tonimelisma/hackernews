/* eslint-disable jsx-a11y/anchor-is-valid */
import React from "react";
import moment from "moment";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faThumbsUp,
  faComments,
  faUser,
  faClock,
} from "@fortawesome/free-regular-svg-icons";

import { faTimes } from "@fortawesome/free-solid-svg-icons";

// story.by, descendants, score, time, title, url

const isSafeUrl = (url) => {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
};

const Story = ({ story, addHidden }) => {
  let favicon
  try {
    favicon = story.url
      ? "https://www.google.com/s2/favicons?domain=" + new URL(story.url).hostname
      : "https://www.google.com/s2/favicons?domain=news.ycombinator.com";
  } catch {
    favicon = "https://www.google.com/s2/favicons?domain=news.ycombinator.com";
  }

  const originalDiscussionUrl = (id) =>
    `https://news.ycombinator.com/item?id=${id}`;

  return (
    <div className="bg-light text-dark rounded border-bottom border-right d-flex p-md-3 p-sm-2 px-2 mx-md-3 my-md-1">
      <div>
        <img src={favicon} alt="favicon" />{" "}
      </div>{" "}
      <div className="px-3">
        {isSafeUrl(story.url) ? (
          <a href={story.url}> {story.title} </a>
        ) : (
          <span> {story.title} </span>
        )} <br />
        <small>
          <FontAwesomeIcon icon={faUser} /> {story.by} &nbsp;&nbsp;{" "}
          <FontAwesomeIcon icon={faClock} /> {moment(story.time).fromNow()}
        </small>{" "}
      </div>{" "}
      <div
        className="btn-group btn-group-sm d-flex align-items-center"
        role="group"
      >
        <a href="#" role="button" className="btn btn-outline-secondary">
          <FontAwesomeIcon icon={faThumbsUp} />
          {" "}{story.score}
        </a>{" "}
        <a
          href={originalDiscussionUrl(story.id)}
          className="btn btn-outline-secondary"
        >
          <FontAwesomeIcon icon={faComments} />
          {" "}{story.descendants}
        </a>{" "}
        <a
          href="#"
          role="button"
          className="btn btn-outline-secondary"
          onClick={() => addHidden(story.id)}
        >
          <FontAwesomeIcon icon={faTimes} />{" "}
        </a>{" "}
      </div>{" "}
    </div>
  );
};

export default Story;
