#
# CloudSQL Postgres Database
#

# CloudSQL requires that a fairly long, unspecified amount of time
# passes before a database name can be reused. To ease testing where
# we create and destroy databases a lot, we append 4 random digits to
# the database name.
resource "random_integer" "dbname" {
  min = 1000
  max = 9999
  keepers = {
    indexer = "${var.indexer}"
  }
}

resource "google_sql_database_instance" "graph" {
  database_version = "POSTGRES_12"
  name             = "${var.indexer}-${random_integer.dbname.result}"
  settings {
    activation_policy = "ALWAYS"
    availability_type = "ZONAL"
    disk_autoresize   = true
    disk_size         = 100
    disk_type         = "PD_SSD"
    tier              = var.database_tier
    ip_configuration {
      ipv4_enabled    = false
      private_network = "projects/${var.project}/global/networks/default"
    }
    backup_configuration {
      binary_log_enabled = false
      enabled            = true
      start_time         = "02:00"
    }
    database_flags {
      name  = "log_temp_files"
      value = "-1"
    }
    database_flags {
      name  = "log_lock_waits"
      value = "on"
    }
  }
}

resource "google_sql_database" "graph" {
  name     = "graph"
  instance = google_sql_database_instance.graph.name
}

resource "google_sql_database" "indexer-service" {
  name     = "indexer-service"
  instance = google_sql_database_instance.graph.name
}

resource "google_sql_database" "vector" {
  name     = "vector"
  instance = google_sql_database_instance.graph.name
}

resource "google_sql_user" "graph" {
  name     = "graph"
  instance = google_sql_database_instance.graph.name
  password = var.database_password
}
