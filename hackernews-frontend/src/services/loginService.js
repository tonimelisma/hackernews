import axios from "axios";
const baseUrl =
  process.env.NODE_ENV === "production"
    ? "https://tonidemo.herokuapp.com/api/v1/login"
    : "http://localhost:3000/api/v1/login";

const login = async (form) => {
  /* try {*/
  const response = await axios.post(baseUrl, form);
  return response.data;
  /*  } catch (e) {
      console.log("login error: ", e);
      return null;
    }*/
};

const loginService = { login };

export default loginService;
