# Getting started

## Creating basic infrastructure with Terraform

* You will need a Google Cloud Project and should have the `gcloud` and
  `kubectl` command line tools installed and configured to interact with
  that project as described in the Google Cloud documentation
* Create a Google Cloud service account [following these
  instructions](https://www.terraform.io/docs/providers/google/guides/getting_started.html#adding-credentials)
  in the Google Cloud Project in which you will create your indexer and
  store its credentials in the file `.gcloud-credentials.json` in this
  directory.
* Read through `variables.tf` and create a file `terraform.tfvars` in this
  directory. For each variable where you want to override the default, or
  where you need to set a value, enter a setting into
  `terraform.tfvars`. At a minimum, you need to provide the name of your
  existing Google Cloud Project and a name for the indexer, e.g.,
  ```
  project = "my-google-cloud-project"
  indexer = "idefix"
  ```
* Run `terraform init` to install required plugins
* Run `terraform plan` to see what resources will be created
* Run `terraform apply` to actually create the resources. This can take up
  to 30 minutes
* Create a kubernetes context for the cluster
  `gcloud container clusters get-credentials idefix`
* Use that context by default:
  `kubectl config use-context idefix`

## Creating the Kubernetes resources for the indexer

* Copy the directory `k8s/overlays` to a new directory `$dir`, and adjust
  the `bases` entry in `$dir/kustomization.yaml` so that it points to the
  directory `k8s/base`
* Read through all the files in `$dir` and adjust any values as indicated
  in the comments
* Deploy all resources with `kubectl apply -k $dir`

# Using the shell container

The kubernetes setup starts a container meant for interacting with the
cluster 'from the inside'

## Managing subgraphs

```bash
kubectl exec shell -- create me/mysubgraph
kubectl exec shell -- deploy me/mysubgraph Qmmysubgraph index_node_0
```
