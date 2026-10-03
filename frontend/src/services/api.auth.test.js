// The captcha-guarded auth endpoints, checked at the wire.
//
// The server verifies a Turnstile token on all three steps of signing in and
// resetting a password, and reads it from `captcha_token`. `resetPassword` used
// to post no token at all, so with Turnstile configured every reset failed on
// the last step - after the code had already been emailed, which is why it
// looked like "the OTP arrives but the password never changes".

import axios from "axios";

jest.mock("axios", () => {
  const post = jest.fn(() => Promise.resolve({ data: {} }));
  const get = jest.fn(() => Promise.resolve({ data: {} }));
  return {
    __esModule: true,
    default: {
      create: () => ({
        post,
        get,
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() },
        },
      }),
    },
  };
});

const { adminLogin, forgotPassword, resetPassword } = require("./api");
const client = axios.create();

beforeEach(() => {
  client.post.mockClear();
});

const bodyOf = (path) => {
  const call = client.post.mock.calls.find(([url]) => url === path);
  if (!call) throw new Error(`nothing was posted to ${path}`);
  return call[1];
};

test("signing in sends the captcha token", async () => {
  await adminLogin("admin@example.com", "secret", "token-abc");
  expect(bodyOf("/admin/login").captcha_token).toBe("token-abc");
});

test("requesting a reset code sends the captcha token", async () => {
  await forgotPassword("admin@example.com", "token-def");
  expect(bodyOf("/admin/forgot-password").captcha_token).toBe("token-def");
});

test("redeeming a reset code sends the captcha token", async () => {
  await resetPassword("admin@example.com", "123456", "BrandNewPass123", "token-ghi");

  const body = bodyOf("/admin/reset-password");
  expect(body).toEqual({
    email: "admin@example.com",
    code: "123456",
    new_password: "BrandNewPass123",
    // Without this the server answers "Please complete the security check" and
    // the reset can never be completed from the UI
    captcha_token: "token-ghi",
  });
});
