/** Where a paper's cover (the JPEG of its first page, made by the page at upload) is kept in R2. Its own module so that the share routes need not import the papers' routes. */
export const coverKey = (userId: string, id: string) => `docs/${userId}/${id}.cover.jpg`;
