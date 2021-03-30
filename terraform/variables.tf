#
# General setup of the Google Cloud Provider
#
variable "project" {
  type        = string
  description = "The name of the Google Cloud Project in which resources will live"
}

variable "region" {
  type        = string
  description = "The name of the Google Cloud region"
  default     = "us-central1"
}

variable "zone" {
  type        = string
  description = "The name of the Google Cloud zone"
  default     = "us-central1-a"
}

#
# Indexer-specific parameters
#
variable "indexer" {
  type        = string
  description = "A unique name for the indexer"
}

variable "default_machine_type" {
  type        = string
  default     = "n1-standard-4"
  description = "The type of machine to use for kubernetes nodes"
}

variable "machine_type" {
  type        = string
  default     = "n1-standard-8"
  description = "The type of machine to use for kubernetes nodes"
}

variable "preemptible" {
  default     = false
  description = "Whether to use preemptible machines for kubernetes nodes"
}

variable "secure_boot" {
  default     = false
  description = "Whether to enable secure boot for kubernetes nodes"
}

variable "release_channel" {
  type        = string
  default     = "UNSPECIFIED"
  description = "The release channel of the Kubernetes cluster"
}

variable "image_type" {
  type        = string
  default     = "COS"
  description = "The image type to use for kubernetes nodes"
}

variable "database_tier" {
  type        = string
  default     = "db-custom-4-4096"
  description = "The type of machine to use for the database"
}

variable "database_password" {
  type        = string
  description = "The database password"
}

variable "indexer_mnemonic" {
  type        = string
  description = "Mnemonic for the indexer's Ethereum private key"
}

variable "indexer_address" {
  type        = string
  description = "The indexer's (not the operator's) Ethereum address"
}

variable "ethereum_chain_name" {
  type        = string
  description = "Name of the Ethereum network (mainnet for mainnet, rinkeby for testnet)"
}

variable "ethereum_chain_id" {
  type        = number
  description = "Numeric chain ID of the Ethereum network (1 for mainnet, 4 for testnet)"
}

variable "ethereum_provider" {
  type        = string
  description = "Ethereum node or provider URL"
}

variable "free_query_auth_token" {
  type        = string
  description = "Auth token that can be used to send free queries to the indexer"
  default     = ""
}

variable "network_subgraph_endpoint" {
  type        = string
  description = "An endpoint that serves the network subgraph deployment"
}

variable "sizes" {
  type = object({
    query_pool   = number
    index_pool   = number
    default_pool = number
  })
  default = {
    query_pool   = 1
    index_pool   = 1
    default_pool = 5
  }
  description = "The number of machines to put into each k8s node pool"
}

variable "prometheus_disk_size" {
  type        = number
  default     = 256
  description = "The size of the disk that stores monitoring data (in GB)"
}

# Vector

variable "vector_admin_token" {
  type        = string
  description = "Token for managing the Vector node"
}

variable "vector_router" {
  type        = string
  description = "Public identifier of a Vector router"
}
