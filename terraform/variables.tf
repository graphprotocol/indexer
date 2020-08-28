#
# General setup of the Google Cloud Provider
#
variable "project" {
  type = string
  description = "The name of the Google Cloud Project in which resources will live"
}

variable "region" {
  type = string
  description = "The name of the Google Cloud region"
  default = "us-central1"
}

variable "zone" {
  type = string
  description = "The name of the Google Cloud zone"
  default = "us-central1-a"
}

#
# Indexer-specific parameters
#
variable "indexer" {
  type = string
  description = "A unique name for the indexer"
}

variable "machine_type" {
  type = string
  default = "n1-standard-8"
  description = "The type of machine to use for kubernetes nodes"
}

variable "preemptible" {
  default = false
  description = "Whether to use preemptible machines for kubernetes nodes"
}

variable "secure_boot" {
  default = false
  description = "Whether to enable secure boot for kubernetes nodes"
}

variable "release_channel" {
  type = string
  default = "UNSPECIFIED"
  description = "The release channel of the Kubernetes cluster"
}

variable "database_tier" {
  type = string
  default = "db-custom-4-4096"
  description = "The type of machine to use for the database"
}

variable "database_password" {
  type = string
  description = "The database password"
}

variable "indexer_mnemonic" {
  type = string
  description = "Mnemonic for the indexer's Ethereum private key"
}

variable "sizes" {
  type = object({
    query_pool = number
    index_pool = number
    default_pool = number
  })
  default = {
    query_pool = 1
    index_pool = 1
    default_pool = 1
  }
  description = "The number of machines to put into each k8s node pool"
}

variable "prometheus_disk_size" {
  type = number
  default = 256
  description = "The size of the disk that stores monitoring data (in GB)"
}

# Temporary
variable "dockerhub_username" {
  type = string
  description = "DockerHub username"
}
variable "dockerhub_password" {
  type = string
  description = "DockerHub password"
}
variable "dockerhub_email" {
  type = string
  description = "DockerHub email"
}