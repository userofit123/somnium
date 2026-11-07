import { sweep } from "./db";
// A test that crashed before its own cleanup must not leave an account behind.
export default async function () { sweep(); }
