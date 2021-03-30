data "template_file" "vector-config" {
  template = file("${path.module}/vector-config.json")
  vars = {
    admin_token  = var.vector_admin_token
    chain_id     = var.ethereum_chain_id
    provider_url = var.ethereum_provider
    mnemonic     = var.indexer_mnemonic
  }
}

resource "kubernetes_secret" "vector-env" {
  metadata {
    name = "vector-env"
  }
  data = {
    mnemonic = var.indexer_mnemonic
    router   = var.vector_router
    config   = data.template_file.vector-config.rendered
  }
}
