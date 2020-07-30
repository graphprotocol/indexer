# Graph Protocol Indexer Components

[![Build Status](https://travis-ci.com/graphprotocol/indexer.svg?branch=master)](https://travis-ci.com/graphprotocol/indexer)

This repository is managed using [Lerna](https://lerna.js.org/) and [Yarn
workspaces](https://classic.yarnpkg.com/en/docs/workspaces/).

[Chan](https://github.com/geut/chan/tree/master/packages/chan) is used to
maintain the following changelogs:

- [indexer-service](packages/indexer-service/CHANGELOG.md)
- [indexer-agent](packages/indexer-agent/CHANGELOG.md)
- [pricing-agent](packages/pricing-agent/CHANGELOG.md)
- [resource-monitor](packages/resource-monitor/CHANGELOG.md)
- [signal-aggregator](packages/signal-aggregator/CHANGELOG.md)

## Install dependencies

```sh
yarn
```

## Build

```sh
yarn prepare
```

## Releases

Creating a new release involves the following steps:

1. Update all changelogs:

   ```sh
   cd packages/indexer-service
   chan added ...
   chan fixed ...
   chan changed ...
   chan release <new-version>
   cd ../..

   cd packages/indexer-agent
   ...
   cd ../..

   cd packages/pricing-agent
   ...
   cd ../..

   cd packages/resource-monitor
   ...
   cd ../..

   cd packages/signal-aggregator
   ...
   cd ../..
   ```

2. Commit these changelogs:

   ```sh
   git add packages/**/CHANGELOG.md
   git commit -m "Update changelogs ahead of release"
   ```

3. Publish a new release:

   ```sh
   lerna publish
   ```

   When it asks for the version to release, select the same one that was used
   when updating the changelogs.

## Deployment

### Manual or local deployment

The easiest way to build the indexer components is to build Docker images for
all of them and then run them.

1. Indexer service:

   ```sh
   # Build image
   docker build \
     --build-arg NPM_TOKEN=<npm-token> \
     -f Dockerfile.indexer-service \
     -t indexer-service:latest \
     .

   # Run indexer service
   docker run \
     -p 7600:7600 \
     -it indexer-service:latest
   ```

   After this, the indexer service should be up and running at
   http://localhost:7600/.

2. Indexer Agent

    ```sh
       # Build image
       docker build \
         --build-arg NPM_TOKEN=<npm-token> \
         -f Dockerfile.indexer-agent \
         -t indexer-agent:latest \
         .
    
       # Run indexer agent 
       # Note: This assumes a `graph-node` is accessible on localhost with the admin endpoint on port 8020 and status endpoint on port 8030. 
       docker run \
         -p 8020:8020 \
         -p 8030:8030 \
         -it indexer-agent:latest        
       ```

   After this, the indexer agent should be up and running.

### Deployment using Kubernetes

To deploy the indexer components with Kubernetes, the following steps are
necessary:

1. Setup Kubernetes

    Local development
    ```sh        
    # Start kubernetes cluster   
    minikube start
    # Configure kubectl to use the minikube context
    kubectl config use-context minikube
    ```
   
    Hosted on Google Cloud
      - Replace the <CLUSTER> and <PROJECT> strings with values from your infrastructure
    ```sh     
    # Configure kubernetes CLI to connect to the remote kubernetes cluster
    gcloud config set project <PROJECT>;
    gcloud container clusters get-credentials <CLUSTER> --zone us-central1-a;
    kubectl config use-context gke_<PROJECT>_us-central1-a_<CLUSTER>;           
    ```
   
2. Indexer service:

   ```sh
   # Build Docker image
   docker build \
     --build-arg NPM_TOKEN=<npm-token> \
     -f Dockerfile.indexer-service \
     -t indexer-service:latest \
     .

   cd packages/indexer-service/k8s

   # Inject image into the k8s config
   kustomize edit set image indexer-service=indexer-service:latest

   # Apply the k8s config
   kubectl apply -k .
   ```

3. Indexer agent:

   ```sh
   # Build Docker image
   docker build \
     --build-arg NPM_TOKEN=<npm-token> \
     -f Dockerfile.indexer-agent \
     -t indexer-agent:latest \
     .

   cd packages/indexer-agent/k8s

   # Inject image into the k8s config
   kustomize edit set image indexer-agent=indexer-agent:latest

   # Apply the k8s config
   kubectl apply -k . 
   ```
   
### Deployment using Google Cloud Build and Kubernetes

#### Secrets

1. Indexer service:

   ```sh
   # Postgres
   kubectl create secret generic indexer-service-postgres-credentials \
     --from-literal=host=<host> \
     --from-literal=username=<username> \
     --from-literal=password=<password> \
     --from-literal=db=indexer-service

   # Ethereum
   kubectl create secret generic indexer-service-eth-provider \
     --from-literal=url=<ethereum-provider>
   kubectl create secret generic indexer-service-eth-account \
     --from-literal=mnemonic=<mnemonic>
   ```
2. Indexer agent:

   ```sh
   # Indexer graph-node
   kubectl create secret generic indexer-agent-graph-node \
     --from-literal=admin-endoint=<host> \
     --from-literal=status-endpoint=<username>    
   ```
   
#### Cloud Build

Set up the following triggers in Cloud Build:

```sh
Repository: graphprotocol/indexer
Name: Deploy indexer components
Trigger type: Branch
Branch (regex): ^master$
Build configuration: Cloud Build configuration file
cloudbuild.yaml location: /cloudbuild.yaml
Substition variables:
  - _NPM_TOKEN
  - _CLOUDSDK_COMPUTE_ZONE
  - _CLOUDSDK_CONTAINER_CLUSTER
```

# Copyright

Copyright &copy; 2020 Graph Protocol, Inc.
