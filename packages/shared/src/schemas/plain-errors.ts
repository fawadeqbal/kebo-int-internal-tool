import { z } from "zod";

/**
 * Zod's own messages in plain words, for every check that names none of its own (review 24 Nov: "Invalid input:
 * expected number, received NaN", "Too big: expected array to have <=20 items"). A message a schema gives itself
 * always wins; anything not listed keeps Zod's. Called once where checking starts (the API's setup).
 */
export function plainErrors() {
  z.config({
    customError: (iss) => {
      switch (iss.code) {
        case "invalid_type":
          return iss.input === undefined || iss.input === null ? "This is needed." : iss.expected === "number" ? "Type a number." : "This is not valid here.";
        case "too_big":
          return iss.origin === "array" || iss.origin === "set"
            ? `Choose at most ${iss.maximum}.`
            : iss.origin === "string"
              ? `Keep it to ${iss.maximum} characters.`
              : `It can be at most ${iss.maximum}.`;
        case "too_small":
          return iss.origin === "array" || iss.origin === "set"
            ? `Choose at least ${iss.minimum}.`
            : iss.origin === "string"
              ? Number(iss.minimum) <= 1
                ? "This is needed."
                : `Type at least ${iss.minimum} characters.`
              : `It must be at least ${iss.minimum}.`;
        case "invalid_format":
          return iss.format === "email" ? "Type an email address, like name@example.com." : iss.format === "uuid" ? "Choose one from the list." : "This is not written the right way.";
        case "invalid_value":
          return "Choose one from the list.";
        case "not_multiple_of":
          return `Use steps of ${iss.divisor}.`;
        default:
          return undefined;
      }
    },
  });
}

/** A message from plainErrors (not one a schema wrote): said with the field it is about ("Amount: type a number."). */
export const isPlainError = (message: string) =>
  /^(This is needed|Type a number|This is not valid here|Choose one from the list|Choose at (most|least)|Keep it to|It (can|must) be at|Type at least|This is not written|Use steps of|Type an email address, like name@)/.test(message);

/** "paidOn" → "Paid on", "lines" → "Lines": a field's name in words, for a message. */
export const fieldWords = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
