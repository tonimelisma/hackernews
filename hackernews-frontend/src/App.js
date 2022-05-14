/* eslint-disable jsx-a11y/anchor-is-valid */
import React, { useState, useEffect } from "react";
// import $ from "jquery";
// import Popper from "popper.js";
import "bootstrap/dist/js/bootstrap.bundle.min";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHackerNewsSquare } from "@fortawesome/free-brands-svg-icons";
import { faUserCircle, faSignInAlt } from "@fortawesome/free-solid-svg-icons";

import "./App.css";
import storyService from "./services/storyService";
import loginService from "./services/loginService";
import StoryList from "./components/StoryList";

const App = () => {
  const [stories, setStories] = useState([]);
  const [timespan, setTimespan] = useState("Day");
  const [hidden, setHidden] = useState([]);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [token, setToken] = useState(null);

  useEffect(() => {
    console.log("fetching stories...");
    setLoading(true);
    storyService
      .getAll(timespan)
      .then((response) => {
        console.log("...got them");
        setStories(response.data);
        setLoading(false);
      })
      .catch((e) => {
        console.log("didn't get them for timespan [", timespan, "] ", e);
        setLoading(false);
      });
  }, [timespan]);

  useEffect(() => {
    const localToken = window.localStorage.getItem("loginToken");
    if (localToken) {
      setToken(localToken);
    }
  }, []);

  useEffect(() => {
    if (token) {
      console.log("fetching hidden...");
      storyService
        .getHidden(token)
        .then((response) => {
          console.log("...got hidden");
          setHidden(response.data);
        })
        .catch((e) => {
          console.log("whoopsie:", e);
          setHidden(null);
        });
    }
  }, [token]);

  const addHidden = (id) => {
    console.log("hiding: ", id, ":", hidden);
    const updatedHidden = hidden.concat(id);
    setHidden(updatedHidden);
    if (token) {
      storyService.addHidden(id, token);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    try {
      const recvToken = await loginService.login({
        goto: "news",
        acct: username,
        pw: password,
      });
      recvToken.token ? setToken(recvToken.token) : setToken(null);
      setLoginError(false);
      setUsername("");
      setPassword("");
      window.localStorage.setItem("loginToken", recvToken.token);
    } catch (error) {
      setLoginError(true);
      // TODO FIXME
      //$("#loginDropdownMenu").dropdown("toggle");
    }
  };

  const loginForm = () => {
    return (
      <form className="px-2" onSubmit={handleLogin}>
        <div className="mb-3 form-group">
          Username
          <input
            type="text"
            value={username}
            name="Username"
            onChange={({ target }) => setUsername(target.value)}
          />
        </div>
        <div className="mb-3 form-group">
          Password
          <input
            type="password"
            value={password}
            name="Password"
            onChange={({ target }) => setPassword(target.value)}
          />
        </div>
        <button type="submit" className="btn-dark btn-md mb-2 form-group">
          Login
        </button>
        {loginError ? (
          <div className="mb-3 text-danger">Wrong username/password</div>
        ) : null}
        <div className="small form-group">
          <small>
            Use your Hacker News login or{" "}
            <a href="https://news.ycombinator.com/login">register there</a>
          </small>
        </div>
      </form>
    );
  };

  const navBar = () => {
    return (
      <nav className="navbar fixed-top navbar-expand navbar-dark bg-dark d-flex justify-content-start align-items-center">
        <div className="navbar-brand h1 m-0 mr-3">
          <FontAwesomeIcon
            icon={faHackerNewsSquare}
            size="lg"
            className="mr-2"
          />
          Top Hacker News Stories
        </div>
        <div className="btn-group d-md-none">
          <button
            className="btn btn-sm btn-light"
            type="button"
            data-toggle="dropdown"
          >
            {timespan}
          </button>
          <div className="dropdown-menu dropdown-menu-right">
            <div className="btn-group btn-group-sm">{timespanButtons()}</div>
          </div>
        </div>
        <div className="btn-group btn-group-sm d-none d-md-block">
          {timespanButtons()}
        </div>
        <div className="btn-group">
          <a className="btn" data-toggle="dropdown" href="#">
            {token ? (
              <FontAwesomeIcon
                icon={faUserCircle}
                size="lg"
                className="m-auto"
                inverse
              />
            ) : (
              <FontAwesomeIcon
                icon={faSignInAlt}
                size="lg"
                className="m-auto"
                inverse
              />
            )}
          </a>
          <div
            className="dropdown-menu dropdown-menu-right"
            id="loginDropdownMenu"
          >
            {token ? <div className="m-3">Logged in</div> : loginForm()}
          </div>
        </div>
      </nav>
    );
  };

  const timespanButtons = () => {
    return (
      <>
        <button className="btn btn-light" onClick={() => setTimespan("Day")}>
          Day
        </button>
        <button className="btn btn-light" onClick={() => setTimespan("Week")}>
          Week
        </button>
        <button className="btn btn-light" onClick={() => setTimespan("Month")}>
          Month
        </button>
        <button className="btn btn-light" onClick={() => setTimespan("Year")}>
          Year
        </button>
        <button className="btn btn-light" onClick={() => setTimespan("All")}>
          All
        </button>
      </>
    );
  };

  return (
    <div>
      {navBar()}
      <main>
        {loading ? (
          <div className="alert alert-primary align-middle m-3" role="alert">
            Loading... <div className="spinner-border" role="status" />
          </div>
        ) : (
          <StoryList stories={stories} hidden={hidden} addHidden={addHidden} />
        )}
      </main>
    </div>
  );
};

export default App;
