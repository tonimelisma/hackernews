import React, { useState, useEffect } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHackerNewsSquare } from "@fortawesome/free-brands-svg-icons";
import { faUserCircle, faSignInAlt } from "@fortawesome/free-solid-svg-icons";

import "./App.css";
import storyService from "./services/storyService";
import loginService from "./services/loginService";
import StoryList from "./components/StoryList";
import useTheme from "./hooks/useTheme";

const loadLocalHidden = () => {
  try {
    const saved = localStorage.getItem("hiddenStories");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
};

const saveLocalHidden = (hidden) => {
  try { localStorage.setItem("hiddenStories", JSON.stringify(hidden)); }
  catch { /* full or unavailable */ }
};

const App = () => {
  useTheme();
  const [stories, setStories] = useState([]);
  const [timespan, setTimespan] = useState("Day");
  const [hidden, setHidden] = useState(() => loadLocalHidden());
  const [hiddenLoaded, setHiddenLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    storyService
      .getAll(timespan)
      .then((response) => {
        setStories(response.data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load stories.");
        setLoading(false);
      });
  }, [timespan]);

  useEffect(() => {
    loginService
      .getMe()
      .then((data) => {
        setLoggedIn(true);
        setLoggedInUser(data.username);
      })
      .catch(() => {
        setLoggedIn(false);
        setLoggedInUser("");
        setHiddenLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (loggedIn) {
      storyService
        .getHidden()
        .then((response) => {
          const local = loadLocalHidden();
          const merged = [...new Set([...response.data, ...local])];
          setHidden(merged);
          saveLocalHidden(merged);
          setHiddenLoaded(true);
        })
        .catch(() => {
          setHiddenLoaded(true);
        });
    }
  }, [loggedIn]);

  const addHidden = (id) => {
    const previousHidden = hidden;
    const updatedHidden = hidden.concat(id);
    setHidden(updatedHidden);
    saveLocalHidden(updatedHidden);
    if (loggedIn) {
      storyService.addHidden(id).catch(() => {
        setHidden(previousHidden);
        saveLocalHidden(previousHidden);
      });
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    try {
      const response = await loginService.login({
        goto: "news",
        acct: username,
        pw: password,
      });
      setLoggedIn(true);
      setLoggedInUser(response.username);
      setLoginError(false);
      setUsername("");
      setPassword("");
    } catch (error) {
      setLoginError(true);
    }
  };

  const handleLogout = async () => {
    try {
      await loginService.logout();
    } catch (error) {
      // logout best-effort
    }
    setLoggedIn(false);
    setLoggedInUser("");
  };

  const loginForm = () => {
    return (
      <form className="px-2" onSubmit={handleLogin}>
        <div className="mb-3 form-group">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            className="form-control"
            type="text"
            value={username}
            name="Username"
            onChange={({ target }) => setUsername(target.value)}
          />
        </div>
        <div className="mb-3 form-group">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            className="form-control"
            type="password"
            value={password}
            name="Password"
            onChange={({ target }) => setPassword(target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-md mb-2 form-group">
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
      <nav className="navbar fixed-top navbar-expand navbar-dark bg-dark d-flex justify-content-start align-items-center px-3">
        <div className="navbar-brand h1 m-0 me-3">
          <FontAwesomeIcon
            icon={faHackerNewsSquare}
            size="lg"
            className="me-2"
          />
          Top Hacker News Stories
        </div>
        <div className="btn-group d-md-none">
          <button
            className="btn btn-sm btn-light"
            type="button"
            data-bs-toggle="dropdown"
          >
            {timespan}
          </button>
          <div className="dropdown-menu dropdown-menu-end">
            <div className="btn-group btn-group-sm">{timespanButtons()}</div>
          </div>
        </div>
        <div className="btn-group btn-group-sm d-none d-md-block">
          {timespanButtons()}
        </div>
        <div className="btn-group">
          <button type="button" className="btn" data-bs-toggle="dropdown" data-bs-auto-close="outside">
            {loggedIn ? (
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
          </button>
          <div
            className="dropdown-menu dropdown-menu-end"
            id="loginDropdownMenu"
          >
            {loggedIn ? (
              <div className="m-3">
                Logged in as {loggedInUser}
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary ms-2"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </div>
            ) : (
              loginForm()
            )}
          </div>
        </div>
      </nav>
    );
  };

  const timespanButtons = () => {
    const timespans = ["Day", "Week", "Month", "Year", "All"];
    return (
      <>
        {timespans.map((span) => (
          <button
            key={span}
            className={`btn ${timespan === span ? "btn-primary" : "btn-light"}`}
            onClick={() => setTimespan(span)}
          >
            {span}
          </button>
        ))}
      </>
    );
  };

  return (
    <div>
      {navBar()}
      <main>
        {error && <div className="alert alert-danger m-3">{error}</div>}
        {(loading || !hiddenLoaded) ? (
          <div className="alert alert-primary align-middle m-3" role="alert">
            Loading... <div className="spinner-border" role="status" />
          </div>
        ) : (
          !error && <StoryList stories={stories} hidden={hidden} addHidden={addHidden} />
        )}
      </main>
    </div>
  );
};

export default App;
