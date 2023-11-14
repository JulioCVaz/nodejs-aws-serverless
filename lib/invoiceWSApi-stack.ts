import * as cdk from "aws-cdk-lib"
import * as apigatewayv2 from "@aws-cdk/aws-apigatewayv2-alpha"
import * as apigatewayv2_integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha"
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as iam from "aws-cdk-lib/aws-iam"
import * as s3n from "aws-cdk-lib/aws-s3-notifications"
import { Construct } from "constructs"

export class InvoiceWSApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        // Invoice and invoice transaction DDB
        const invoicesDdb = new dynamodb.Table(this, "InvoicesDdb", {
            tableName: "invoices",
            billingMode: dynamodb.BillingMode.PROVISIONED,
            readCapacity: 1,
            writeCapacity: 1,
            partitionKey: {
                name: "pk",
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: "sk",
                type: dynamodb.AttributeType.STRING
            },
            timeToLiveAttribute: "ttl",
            removalPolicy: cdk.RemovalPolicy.DESTROY
        })
        // Invoice bucket
        const bucket = new s3.Bucket(this, "InvoiceBucket", {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            lifecycleRules: [
                {
                    enabled: true,
                    expiration: cdk.Duration.days(1)
                }
            ]
        })
        // websocket connection handler
        const connectionHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceConnectionFunction", {
            runtime: lambda.Runtime.NODEJS_16_X,
            functionName: "InvoiceConnectionFunction", 
            entry: "lambda/invoices/invoiceConnectionFunction.ts",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(2),
            bundling: {
              minify: true,
              sourceMap: false
            },
            tracing: lambda.Tracing.ACTIVE
        })
        // websocket disconnetion handler
        const disconnetionHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceDisconnectionFunction", {
            runtime: lambda.Runtime.NODEJS_16_X,
            functionName: "InvoiceDisconnectionFunction", 
            entry: "lambda/invoices/invoiceDisconnectionFunction.ts",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(2),
            bundling: {
              minify: true,
              sourceMap: false
            },
            tracing: lambda.Tracing.ACTIVE
        })
        // websocket API
        const webSocketAPI = new apigatewayv2.WebSocketApi(this, "InvoiceWSApi", {
            apiName: "InvoiceWSApi",
            connectRouteOptions: {
                integration: new apigatewayv2_integrations.WebSocketLambdaIntegration("ConnectionHandler", connectionHandler)
            },
            disconnectRouteOptions: {
                integration: new apigatewayv2_integrations.WebSocketLambdaIntegration("DisconnectionHandler", disconnetionHandler)
            }
        })

        const stage = "prod"
        const wsApiEndpoint = `${webSocketAPI.apiEndpoint}/${stage}`
        
        new apigatewayv2.WebSocketStage(this, "InvoiceWSApiStage", {
            webSocketApi: webSocketAPI,
            stageName: stage,
            autoDeploy: true
        })
        // invoice URL handler
        const getUrlHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceGetUrlFunction", {
            runtime: lambda.Runtime.NODEJS_16_X,
            functionName: "InvoiceGetUrlFunction", 
            entry: "lambda/invoices/invoiceGetUrlFunction.ts",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(2),
            bundling: {
              minify: true,
              sourceMap: false
            },
            tracing: lambda.Tracing.ACTIVE,
            environment: {
                INVOICE_DDB: invoicesDdb.tableName,
                BUCKET_NAME: bucket.bucketName,
                INVOICE_WSAPI_ENDPOINT: wsApiEndpoint
            }
        })

        const invoicesDdbWriteTransactionPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:PutItem'],
            resources: [invoicesDdb.tableArn],
            conditions: {
                ['ForAllValues:StringLike']: {
                    'dynamodb:LeadingKeys': ['#transaction']
                }
            }
        })

        const invoicesBucketPutObjectPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:PutObject'],
            resources: [`${bucket.bucketArn}/*`]
        })

        getUrlHandler.addToRolePolicy(invoicesDdbWriteTransactionPolicy)
        getUrlHandler.addToRolePolicy(invoicesBucketPutObjectPolicy)
        webSocketAPI.grantManageConnections(getUrlHandler)

        // invoice import handler
        const invoiceImportHandler = new lambdaNodeJS.NodejsFunction(this, "InvoiceImportFunction", {
            runtime: lambda.Runtime.NODEJS_16_X,
            functionName: "InvoiceImportFunction", 
            entry: "lambda/invoices/invoiceImportFunction.ts",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(2),
            bundling: {
              minify: true,
              sourceMap: false
            },
            tracing: lambda.Tracing.ACTIVE,
            environment: {
                INVOICE_DDB: invoicesDdb.tableName,
                INVOICE_WSAPI_ENDPOINT: wsApiEndpoint
            }
        })

        invoicesDdb.grantReadWriteData(invoiceImportHandler)

        // send a event to s3 when invoice was created
        bucket.addEventNotification(
            s3.EventType.OBJECT_CREATED_PUT,
            new s3n.LambdaDestination(invoiceImportHandler)
        )

        const invoicesBucketGetDeleteObjectPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:DeleteObject', 's3:GetObject'],
            resources: [`${bucket.bucketArn}/*`]
        })

        invoiceImportHandler.addToRolePolicy(invoicesBucketGetDeleteObjectPolicy)
        webSocketAPI.grantManageConnections(invoiceImportHandler)
        
        // cancel import handler
        const cancelImportHandler = new lambdaNodeJS.NodejsFunction(this, "CancelImportFunction", {
            runtime: lambda.Runtime.NODEJS_16_X,
            functionName: "CancelImportFunction", 
            entry: "lambda/invoices/cancelImportFunction.ts",
            handler: "handler",
            memorySize: 128,
            timeout: cdk.Duration.seconds(2),
            bundling: {
              minify: true,
              sourceMap: false
            },
            tracing: lambda.Tracing.ACTIVE,
            environment: {
                INVOICE_DDB: invoicesDdb.tableName,
                INVOICE_WSAPI_ENDPOINT: wsApiEndpoint
            }
        })

        const invoicesDdbReadWriteTransactionPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:UpdateItem', 'dynamodb:GetItem'],
            resources: [invoicesDdb.tableArn],
            conditions: {
                ['ForAllValues:StringLike']: {
                    'dynamodb:LeadingKeys': ['#transaction']
                }
            }
        })

        cancelImportHandler.addToRolePolicy(invoicesDdbReadWriteTransactionPolicy)
        webSocketAPI.grantManageConnections(cancelImportHandler)

        // websocket api routes
        webSocketAPI.addRoute('getImportUrl', {
            integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
                "GetUrlHandler",
                getUrlHandler
            )
        })

        webSocketAPI.addRoute('cancelImport', {
            integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
                "CancelImportHandler",
                cancelImportHandler
            )
        })
    }
}
