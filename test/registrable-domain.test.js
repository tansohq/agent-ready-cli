import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registrableDomain, sameSite } from "../src/interface/sources.js";

describe("registrableDomain", () => {
  it("keeps the last two labels for ordinary suffixes", () => {
    assert.equal(registrableDomain("docs.stripe.com"), "stripe.com");
    assert.equal(registrableDomain("www.example.io"), "example.io");
  });

  it("keeps three labels under a two-label public suffix", () => {
    assert.equal(registrableDomain("www.bbc.co.uk"), "bbc.co.uk");
    assert.equal(registrableDomain("api.shop.com.au"), "shop.com.au");
    assert.equal(registrableDomain("docs.example.co.jp"), "example.co.jp");
  });

  it("does not treat two unrelated .co.uk sites as the same site", () => {
    assert.equal(sameSite("https://docs.acme.co.uk/pricing", "https://acme.co.uk"), true);
    assert.equal(sameSite("https://evil.co.uk/pricing", "https://acme.co.uk"), false);
  });
});
