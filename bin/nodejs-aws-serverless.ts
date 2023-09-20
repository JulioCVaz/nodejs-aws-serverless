#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

import { ProductsAppStack } from '../lib/productsApp-stack';
import { EcommerceApiStack } from '../lib/ecommerceApi-stack';

const app = new cdk.App();

const env: cdk.Environment = {
  account: "373121626290",
  region: "us-east-1"
}

// @note to add notation to the stack
const tags = {
  cost: "Ecommerce",
  team: "SiecolaCode"
}

const productsAppStack = new ProductsAppStack(app, "ProductsApp", {
  tags,
  env
})

const ecommerceApiStack = new EcommerceApiStack(app, "EcommerceApi", {
  productsFetchHandler: productsAppStack.productsFetchHandler,
  tags,
  env
})

ecommerceApiStack.addDependency(productsAppStack)