import { createTranslator } from "next-intl";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";

/** Messages outside a request, in a given language: e.g. a push sent in each recipient's language. */
export const translatorFor = (locale: "ar" | "fr") => createTranslator({ locale, messages: locale === "ar" ? ar : fr });
