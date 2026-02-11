import axios from "axios";
const baseUrl = "/api/v1/login";

const login = async (form) => {
  const response = await axios.post(baseUrl, form);
  return response.data;
};

const loginService = { login };

export default loginService;
