import { expect, test } from "vitest";
import { pgConnection } from "./db";

const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

test("without a CA the URL is used as given", () => {
  expect(pgConnection("postgresql://u:p@h:6543/postgres?sslmode=require", undefined)).toEqual({ connectionString: "postgresql://u:p@h:6543/postgres?sslmode=require" });
  expect(pgConnection("", CA)).toEqual({ connectionString: "" });
});

test("with a CA, TLS is verified against it and the URL's ssl parameters can't override it", () => {
  const url = "postgresql://postgres.ref:p%40ss@aws-0-eu-west-3.pooler.supabase.com:6543/postgres?sslmode=require&uselibpqcompat=true&sslrootcert=x.crt&application_name=app";
  expect(pgConnection(url, CA)).toEqual({
    connectionString: "postgresql://postgres.ref:p%40ss@aws-0-eu-west-3.pooler.supabase.com:6543/postgres?application_name=app",
    ssl: { ca: CA },
  });
});

test("a CA pasted on one line with escaped newlines is restored", () => {
  expect(pgConnection("postgresql://u:p@h/db", CA.replaceAll("\n", "\n")).ssl).toEqual({ ca: CA });
});
