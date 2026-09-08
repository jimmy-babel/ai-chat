export function adapterDatabaseUrl() {
  const url = process.env.DATABASE_URL || "";
  return url.replace(/^mysql:\/\//, "mariadb://");
}
