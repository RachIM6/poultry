// Public API of the `identity` module (see CAPABILITY-MAP.md). Other modules import only from here.
export { getSession, logout, requestCode, verifyCode } from "./application/login";
export { PhoneNumber } from "./domain/phone-number";
