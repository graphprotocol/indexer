#
# Prometheus
#

resource "google_compute_disk" "prometheus" {
  name = "${var.indexer}-prometheus"
  type = "pd-standard"
  size = var.prometheus_disk_size
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
    volume_name        = kubernetes_persistent_volume.prometheus.metadata.0.name
  }
}
