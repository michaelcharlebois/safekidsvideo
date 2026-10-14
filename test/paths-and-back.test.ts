// Return paths and "Back" links on detail pages.
import { describe, expect, it } from "vitest";
import { withoutParams } from "@/lib/paths";
import { backLink, detailHref } from "@/lib/back";

describe("withoutParams", () => {
  it("drops old outcome notes, keeps the child and the #anchor", () => {
    expect(withoutParams("/parent/library?kid=a&decided=hide&video=x&status=held#v-x", ["decided", "video"])).toBe("/parent/library?kid=a&status=held#v-x");
    expect(withoutParams("/parent/library?error=oops", ["error"])).toBe("/parent/library");
  });
});

describe("back links", () => {
  it("return to Review when opened from Review, keeping the child filter", () => {
    expect(backLink({ from: "review", kid: "p-maya" })).toEqual({ href: "/parent/review?kid=p-maya", label: "Review" });
    expect(backLink({ from: "review" })).toEqual({ href: "/parent/review", label: "Review" });
  });
  it("default to Library (detail pages belong to it); old deep links without ?from still work", () => {
    expect(backLink({})).toEqual({ href: "/parent/library", label: "Library" });
    expect(backLink({ from: "library", kid: "p-leo" }).href).toBe("/parent/library?kid=p-leo");
    expect(backLink({ from: "home", kid: "p-leo" })).toEqual({ href: "/parent?kid=p-leo", label: "Home" });
  });
  it("ignore a child id that isn't a plain id", () => {
    expect(backLink({ from: "review", kid: "x&evil=1" }).href).toBe("/parent/review");
    expect(detailHref("/parent/video/abc", "library", "../x")).toBe("/parent/video/abc?from=library");
    expect(detailHref("/parent/video/abc", "review", "p-maya")).toBe("/parent/video/abc?from=review&kid=p-maya");
  });
});
