#
# Provider configuration
#
provider "google" {
  credentials = file(".gcloud-credentials.json")
  project = var.project
  region  = var.region
  zone    = var.zone
  version = "~> 3.19"
}

# Pull Access Token from gcloud client config
# See: https://www.terraform.io/docs/providers/google/d/datasource_client_config.html
data "google_client_config" "gcloud" {}

provider "kubernetes" {
  load_config_file        = false
  host                    = google_container_cluster.cluster.endpoint
  # Use the token to authenticate to K8s
  token                   = data.google_client_config.gcloud.access_token
  cluster_ca_certificate  = base64decode(google_container_cluster.cluster.master_auth[0].cluster_ca_certificate)
}


#
# Kubernetes cluster
#
resource "google_container_cluster" "cluster" {
  name     = var.indexer

  # We can't create a cluster with no node pool defined, but we want to only use
  # separately managed node pools. So we create the smallest possible default
  # node pool and immediately delete it.
  remove_default_node_pool = true
  initial_node_count       = 1

  network = "projects/${var.project}/global/networks/default"

  master_auth {
    username = ""
    password = ""

    client_certificate_config {
      issue_client_certificate = false
    }
  }

  ip_allocation_policy {
    // Enable IP aliases, but let GKE choose all the values
  }
}

resource "google_container_node_pool" "default_pool" {
  name       = "default-pool"
  cluster    = google_container_cluster.cluster.name
  node_count = var.sizes.default_pool

  node_config {
    preemptible  = false
    machine_type = var.machine_type

    metadata = {
      disable-legacy-endpoints = "true"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/devstorage.read_only",
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring",
      "https://www.googleapis.com/auth/servicecontrol",
      "https://www.googleapis.com/auth/service.management.readonly",
      "https://www.googleapis.com/auth/trace.append"
    ]
  }
}

resource "google_container_node_pool" "query_pool" {
  name       = "query-pool"
  cluster    = google_container_cluster.cluster.name
  node_count = var.sizes.query_pool

  node_config {
    preemptible  = false
    machine_type = var.machine_type

    metadata = {
      disable-legacy-endpoints = "true"
    }

    labels = {
      query = "1"
    }

    taint = [
      {
        effect = "NO_SCHEDULE"
        key    = "query"
        value  = "1"
      },
    ]

    oauth_scopes = [
      "https://www.googleapis.com/auth/devstorage.read_only",
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring",
      "https://www.googleapis.com/auth/servicecontrol",
      "https://www.googleapis.com/auth/service.management.readonly",
      "https://www.googleapis.com/auth/trace.append"
    ]
  }
}

resource "google_container_node_pool" "index_pool" {
  name       = "index-pool"
  cluster    = google_container_cluster.cluster.name
  node_count = var.sizes.index_pool

  node_config {
    preemptible  = false
    machine_type = var.machine_type

    metadata = {
      disable-legacy-endpoints = "true"
    }

    labels = {
      index = "1"
    }

    taint = [
      {
        effect = "NO_SCHEDULE"
        key    = "index"
        value  = "1"
      },
    ]

    oauth_scopes = [
      "https://www.googleapis.com/auth/devstorage.read_only",
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring",
      "https://www.googleapis.com/auth/servicecontrol",
      "https://www.googleapis.com/auth/service.management.readonly",
      "https://www.googleapis.com/auth/trace.append"
    ]
  }
}

#
# CloudSQL Postgres Database
#

# CloudSQL requires that a fairly long, unspecified amount of time
# passes before a database name can be reused. To ease testing where
# we create and destroy databases a lot, we append 4 random digits to
# the database name.
resource "random_integer" "dbname" {
  min     = 1000
  max     = 9999
  keepers = {
    indexer = "${var.indexer}"
  }
}

resource "google_sql_database_instance" "graph" {
  database_version  = "POSTGRES_12"
  name              = "${var.indexer}-${random_integer.dbname.result}"
  settings {
    activation_policy           = "ALWAYS"
    availability_type           = "ZONAL"
    disk_autoresize             = true
    disk_size                   = 100
    disk_type                   = "PD_SSD"
    tier                        = var.database_tier
    ip_configuration {
      ipv4_enabled = false
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

resource "google_sql_user" "graph" {
  name     = "graph"
  instance = google_sql_database_instance.graph.name
  password = var.database_password
}

resource "kubernetes_secret" "postgres-credentials" {
  metadata {
    name = "postgres-credentials"
  }
  data = {
    host = google_sql_database_instance.graph.first_ip_address
    user = google_sql_user.graph.name
    password = var.database_password
  }
}

#
# Persistent disks
#
resource "google_compute_disk" "prometheus" {
  name  = "${var.indexer}-prometheus"
  type  = "pd-standard"
  size  = var.prometheus_disk_size
}

resource "kubernetes_persistent_volume" "prometheus" {
  metadata {
    name = "prometheus"
  }
  spec {
    capacity = {
      storage = "${var.prometheus_disk_size}Gi"
    }
    access_modes = ["ReadWriteOnce"]
    persistent_volume_source {
      gce_persistent_disk {
        pd_name = google_compute_disk.prometheus.name
        fs_type = "ext4"
      }
    }
    storage_class_name = "standard"
  }
}

resource "kubernetes_persistent_volume_claim" "prometheus" {
  metadata {
    name = "prometheus"
  }
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = {
        storage = "${var.prometheus_disk_size}Gi"
      }
    }
    selector {
      match_labels = {
        "name" = kubernetes_persistent_volume.prometheus.metadata.0.name
      }
    }
    storage_class_name = "standard"
    volume_name = kubernetes_persistent_volume.prometheus.metadata.0.name
  }
}

resource "google_compute_disk" "nfs" {
  name  = "${var.indexer}-nfs"
  type  = "pd-standard"
  size  = 256
}

resource "kubernetes_persistent_volume" "nfs" {
  metadata {
    name = "nfs"
  }
  spec {
    capacity = {
      storage = "256Gi"
    }
    access_modes = ["ReadWriteOnce"]
    persistent_volume_source {
      gce_persistent_disk {
        pd_name = google_compute_disk.nfs.name
        fs_type = "ext4"
      }
    }
    storage_class_name = "standard"
  }
}

resource "kubernetes_persistent_volume_claim" "nfs" {
  metadata {
    name = "nfs"
  }
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = {
        storage = "256Gi"
      }
    }
    selector {
      match_labels = {
        "name" = kubernetes_persistent_volume.nfs.metadata.0.name
      }
    }
    storage_class_name = "standard"
    volume_name = kubernetes_persistent_volume.nfs.metadata.0.name
  }
}
