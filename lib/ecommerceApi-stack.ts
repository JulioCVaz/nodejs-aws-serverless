import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import * as cdk from "aws-cdk-lib"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as cwlogs from "aws-cdk-lib/aws-logs"

import { Construct } from "constructs"

interface EcommerceApiStackProps extends cdk.StackProps {
    productsFetchHandler: lambdaNodeJS.NodejsFunction
}

export class EcommerceApiStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props: EcommerceApiStackProps) {
        super(scope, id, props)

        const api = new apigateway.RestApi(this, "EcommerceApi", {
            restApiName: "EcommerceApi"
        })

        const productsFetchIntegration = new apigateway.LambdaIntegration(props.productsFetchHandler)
        // "/products"
        const productResource = api.root.addResource("products")
        productResource.addMethod("GET", productsFetchIntegration)
    }
}