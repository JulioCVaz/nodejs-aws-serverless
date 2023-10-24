import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import * as cdk from "aws-cdk-lib"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as cwlogs from "aws-cdk-lib/aws-logs"

import { Construct } from "constructs"

interface EcommerceApiStackProps extends cdk.StackProps {
    productsFetchHandler: lambdaNodeJS.NodejsFunction;
    productsAdminHandler: lambdaNodeJS.NodejsFunction;
    ordersHandler: lambdaNodeJS.NodejsFunction;
}

export class EcommerceApiStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props: EcommerceApiStackProps) {
        super(scope, id, props)

        const logGroup = new cwlogs.LogGroup(this, "EcommerceApiLogs")
        const api = new apigateway.RestApi(this, "EcommerceApi", {
            restApiName: "EcommerceApi",
            cloudWatchRole: true, // @note: disable if is needed
            deployOptions: {
                accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
                    httpMethod: true,
                    ip: true, // only development
                    protocol: true,
                    requestTime: true,
                    resourcePath: true,
                    responseLength: true,
                    status: true,
                    caller: true,
                    user: true // only development
                })
            }
        })

        this.createProductsService(props, api)
        this.createOrdersService(props, api)
    }

    private createOrdersService(props: EcommerceApiStackProps, api: apigateway.RestApi) {
        const ordersIntegration = new apigateway.LambdaIntegration(props.ordersHandler)
        const ordersResource = api.root.addResource('orders')

        // GET "/orders"
        // GET "/orders?email=matilde@siecola.com.br"
        // GET "/orders?email=matilde@siecola.com.br&orderId=123"
        ordersResource.addMethod("GET", ordersIntegration)
        // DELETE "/orders?email=matilde@siecola.com.br&orderId=123"
        ordersResource.addMethod("DELETE", ordersIntegration)
        // POST "/orders"
        ordersResource.addMethod("POST", ordersIntegration)
    }

    private createProductsService(props: EcommerceApiStackProps, api: apigateway.RestApi) {
        const productsFetchIntegration = new apigateway.LambdaIntegration(props.productsFetchHandler)
        const productsResource = api.root.addResource("products")

        // GET "/products"
        productsResource.addMethod("GET", productsFetchIntegration)
        // GET "/products/{id}"
        const productIdResource = productsResource.addResource("{id}")
        productIdResource.addMethod("GET", productsFetchIntegration)

        const productsAdminIntegration = new apigateway.LambdaIntegration(props.productsAdminHandler)
        // POST /products
        productsResource.addMethod("POST", productsAdminIntegration)
        // PUT /products/{id}
        productIdResource.addMethod("PUT", productsAdminIntegration)
        // DELETE /products/{id}
        productIdResource.addMethod("DELETE", productsAdminIntegration)
    }
}