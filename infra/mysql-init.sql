-- Dev only: lets Prisma Migrate create its temporary shadow database.
GRANT CREATE, ALTER, DROP, REFERENCES, INDEX ON *.* TO 'toolkitgo'@'%';
GRANT ALL PRIVILEGES ON `prisma_migrate_shadow_db_%`.* TO 'toolkitgo'@'%';
FLUSH PRIVILEGES;
