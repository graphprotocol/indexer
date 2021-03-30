#
# Databases and credentials
#
resource "kubernetes_secret" "postgres-credentials" {
  metadata {
    name = "postgres-credentials"
  }
  data = {
    host       = google_sql_database_instance.graph.first_ip_address
    user       = google_sql_user.graph.name
    password   = var.database_password
    graph_db   = "graph"
    indexer_db = "indexer-service"
    vector_db  = "vector"
  }
}

#
# Operator mnemonic, indexer address and more.
#
resource "kubernetes_secret" "indexer" {
  metadata {
    name = "indexer"
  }
  data = {
    mnemonic              = var.indexer_mnemonic
    indexer_address       = var.indexer_address
    free_query_auth_token = var.free_query_auth_token
  }
}

#
# Network subgraph configuration
#
resource "kubernetes_secret" "network-subgraph" {
  metadata {
    name = "network-subgraph"
  }
  data = {
    endpoint = var.network_subgraph_endpoint
  }
}

#
# Ethereum provider URL
#
resource "kubernetes_secret" "ethereum" {
  metadata {
    name = "ethereum"
  }
  data = {
    network_name = var.ethereum_chain_name
    chain_id     = var.ethereum_chain_id
    url          = var.ethereum_provider
  }
}
