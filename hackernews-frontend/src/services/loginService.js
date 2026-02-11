import axios from "axios";
const baseUrl = "/api/v1/login";

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
