#
# Provider configuration
#
provider "google" {
  credentials = file(".gcloud-credentials.json")
  project     = var.project
  region      = var.region
  zone        = var.zone
  version     = "~> 3.19"
}

# Pull Access Token from gcloud client config
# See: https://www.terraform.io/docs/providers/google/d/datasource_client_config.html
data "google_client_config" "gcloud" {}

provider "kubernetes" {
  load_config_file = false
  host             = google_container_cluster.cluster.endpoint
  # Use the token to authenticate to K8s
  token                  = data.google_client_config.gcloud.access_token
  cluster_ca_certificate = base64decode(google_container_cluster.cluster.master_auth[0].cluster_ca_certificate)
}


#
# Kubernetes cluster
#
resource "google_container_cluster" "cluster" {
  name = var.indexer

  # We can't create a cluster with no node pool defined, but we want to only use
  # separately managed node pools. So we create the smallest possible default
  # node pool and immediately delete it.
  remove_default_node_pool = true
  initial_node_count       = 1

  release_channel {
    channel = var.release_channel
  }

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
    preemptible  = var.preemptible
    machine_type = var.default_machine_type
    image_type   = var.image_type

    shielded_instance_config {
      enable_secure_boot = var.secure_boot
    }

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
    preemptible  = var.preemptible
    machine_type = var.machine_type
    image_type   = var.image_type

    shielded_instance_config {
      enable_secure_boot = var.secure_boot
    }

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
    preemptible  = var.preemptible
    machine_type = var.machine_type
    image_type   = var.image_type

    shielded_instance_config {
      enable_secure_boot = var.secure_boot
    }

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

resource "google_compute_disk" "nfs" {
  name = "${var.indexer}-nfs"
  type = "pd-standard"
  size = 256
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
    volume_name        = kubernetes_persistent_volume.nfs.metadata.0.name
  }
}
