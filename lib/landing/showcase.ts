/** Whose listens the public landing page shows. Self-hosters set their own. */
export const showcaseUser = () => process.env.SHOWCASE_USER || "tordar";
/** Users have no stored time zone; the landing page localizes in this one. */
export const showcaseTz = () => process.env.SHOWCASE_TZ || "Europe/Oslo";
