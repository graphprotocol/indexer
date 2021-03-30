# Getting started

These instructions assume that you are using Google Cloud, and walk you
through the setup from creating a new project for the indexer all the way
to a running indexer infrastructure. If you are already a Google Cloud
user, an important consideration whether you should set up the indexer in a
new or an existing project is that it is not possible to transfer database
backups between projects. These can become quite large, in the range of 1-2
TB, and it can be useful for investigating database related issues to
quickly restore a database backup from the production database into a
database instance dedicated to experimentation. If you decide to create the
indexer infrastructure in an existing Google Cloud project, make sure that
the project has settings that are compatible with the ones described in the
following sections.

If you will not use Google Cloud for your indexer infrastructure, we hope
that these instructions will help you in figuring out how to set up an
indexer and would very much love to incorporate additional instructions.

## Install prerequisites

You will need to have the following tools installed:

- The [Google Cloud SDK](https://cloud.google.com/sdk/install)
- The [Kubectl](https://kubernetes.io/docs/tasks/tools/install-kubectl/)
  command line tool
- [Terraform](https://learn.hashicorp.com/terraform/getting-started/install)

## Create a Google Cloud Project

Make sure you execute all commands inside this directory, and authenticate
with Google Cloud:

```shell
cd terraform/
gcloud auth login
```

Think of a fun, creative name for your project, and create the project:

```shell
project=automatix
gcloud projects create --enable-cloud-apis $project
```

Go to the [Billing](https://console.cloud.google.com/billing/projects)
section of the [Google Cloud Console](https://console.cloud.google.com/)
and enable billing for your project. If you have multiple Google logins,
make sure you use the right account for the project using the account
switcher in the top right of the page.

Besides the project name, which we set as the `project` shell variable, we
will also need the project id and store it in `proj_id`. With that, we can
create a Google Cloud configuration locally:

```shell
proj_id=$(gcloud projects list --format='get(project_id)' --filter="name=$project")
gcloud config configurations create $project
gcloud config set project "$proj_id"
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a
```

Enable a number of Google Cloud API's that the indexer requires:

```shell
gcloud services enable compute.googleapis.com
gcloud services enable container.googleapis.com
gcloud services enable servicenetworking.googleapis.com
gcloud services enable sqladmin.googleapis.com
```

Terraform, which we will use to set up the bulk of the indexer
infrastructure, requires that we have a service account. Pick a name for
that and store it in the variable `svc_name` and then run:

```shell
gcloud iam service-accounts create $svc_name \
    --description="Service account for Terraform" \
    --display-name="$svc_name"
gcloud iam service-accounts list
# Get the email of the service account from the list
svc=$(gcloud iam service-accounts list --format='get(email)' --filter="displayName=$svc_name")
gcloud iam service-accounts keys create .gcloud-credentials.json \
    --iam-account="$svc"
gcloud projects add-iam-policy-binding $proj_id \
  --member serviceAccount:$svc \
  --role roles/editor
```

Finally, we need to enable peering between our database and the Kubernetes
cluster that Terraform will create in the next step:

```shell
gcloud compute addresses create google-managed-services-default \
    --prefix-length=20 \
    --purpose=VPC_PEERING \
    --network default \
    --global \
    --description 'IP Range for peer networks.'
gcloud services vpc-peerings connect \
    --network=default \
    --ranges=google-managed-services-default
```

In the next step, we will need a file `terraform.tfvars`. This command
creates the minimal set of variables that we will need:

```shell
indexer=<pick a fun name for your indexer>
cat > terraform.tfvars <<EOF
project = "$proj_id"
indexer = "$indexer"

indexer_mnemonic = "<operator Ethereum mnemonic>"
indexer_address = "<indexer Ethereum address>"

ethereum_chain_name = "mainnet"
# testnet: ethereum_chain_name = "rinkeby"

ethereum_chain_id = 1
# testnet: ethereum_chain_id = 4

ethereum_provider = "<mainnet or rinkeby Ethereum node/provider>"

network_subgraph_endpoint = "https://gateway.network.thegraph.com/network"
# testnet: network_subgraph_endpoint = "https://gateway.testnet.thegraph.com/network"

vector_admin_token = "<secret token, keep to yourself>"
vector_router = "<Vector router identifier, depends on the network>"

database_password = "<database passowrd>"
EOF
```

## Creating basic infrastructure with Terraform

Before running any commands, read through `variables.tf` and create a file
`terraform.tfvars` in this directory (or modify the one we created in the
last step). For each variable where you want to override the default, or
where you need to set a value, enter a setting into `terraform.tfvars`.

- Run `terraform init` to install required plugins
- Run `terraform plan` to see what resources will be created
- Run `terraform apply` to actually create the resources. This can take up
  to 30 minutes

Once Terraform finishes creating resources, download credentials for the
new cluster into your local `~/.kube/config` file and set it as your
default context:

```shell
gcloud container clusters get-credentials $indexer
kubectl config use-context $(kubectl config get-contexts --output='name' | grep $indexer)
```

## Creating the Kubernetes resources for the indexer

- Copy the directory `k8s/overlays` to a new directory `$dir`, and adjust
  the `bases` entry in `$dir/kustomization.yaml` so that it points to the
  directory `k8s/base`
- Read through all the files in `$dir` and adjust any values as indicated
  in the comments
- Deploy all resources with `kubectl apply -k $dir`

# Using the shell container

The kubernetes setup starts a container meant for interacting with the
cluster 'from the inside'

## Managing subgraphs

```bash
kubectl exec shell -- create me/mysubgraph
kubectl exec shell -- deploy me/mysubgraph Qmmysubgraph index_node_0
```
