import * as lambda from "aws-cdk-lib/aws-lambda"
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import * as cdk from "aws-cdk-lib"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as sns from "aws-cdk-lib/aws-sns"
import * as subs from "aws-cdk-lib/aws-sns-subscriptions"
import * as iam from "aws-cdk-lib/aws-iam"
import * as sqs from "aws-cdk-lib/aws-sqs"
import * as lambdaEventSource from "aws-cdk-lib/aws-lambda-event-sources"

import { Construct } from "constructs"

interface OrdersAppStackProps extends cdk.StackProps {
    productsDdb: dynamodb.Table,
    eventsDdb: dynamodb.Table,
}

export class OrdersAppStack extends cdk.Stack {
    readonly ordersHandler: lambdaNodeJS.NodejsFunction

    constructor(scope: Construct, id: string, props: OrdersAppStackProps) {
      super(scope, id, props)
      
      const ordersDdb = new dynamodb.Table(this, "OrdersDdb", {
        tableName: "orders",
        partitionKey: {
            name: "pk",
            type: dynamodb.AttributeType.STRING
        },
        sortKey: {
            name: "sk",
            type: dynamodb.AttributeType.STRING
        },
        billingMode: dynamodb.BillingMode.PROVISIONED,
        readCapacity: 1,
        writeCapacity: 1
      })

      // Orders Layer
      const ordersLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrdersLayerVersionArn")
      const ordersLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrdersLayerVersionArn", ordersLayerArn)

      // Orders Api Layer
      const ordersApiLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrdersApiLayerVersionArn")
      const ordersApiLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrdersApiLayerVersionArn", ordersApiLayerArn)

      // Orders Events Layer
      const orderEventsLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrderEventsLayerVersionArn")
      const orderEventsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrderEventsLayerVersionArn", orderEventsLayerArn)

      // Orders Events Repository Layer
      const orderEventsRepositoryLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrderEventsRepositoryLayerVersionArn")
      const orderEventsRepositoryLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrderEventsRepositoryLayerVersionArn", orderEventsRepositoryLayerArn)

      // Products Layer
      const productsLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductsLayerVersionArn")
      const productsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductsLayerVersionArn", productsLayerArn)
    
      const ordersTopic = new sns.Topic(this, "OrderEventsTopic", {
        displayName: "Order events topic",
        topicName: "order-events"
      })

      this.ordersHandler = new lambdaNodeJS.NodejsFunction(this, "OrdersFunction", {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: "OrdersFunction", 
        entry: "lambda/orders/ordersFunction.ts",
        handler: "handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(2),
        bundling: {
            minify: true,
            sourceMap: false
        },
        environment: {
            PRODUCTS_DDB: props.productsDdb.tableName,
            ORDERS_DDB: ordersDdb.tableName,
            ORDER_EVENTS_TOPIC_ARN: ordersTopic.topicArn
        },
        layers: [ordersLayer, productsLayer, ordersApiLayer, orderEventsLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      })

      ordersDdb.grantReadWriteData(this.ordersHandler)
      // ensure only read data from products table
      props.productsDdb.grantReadData(this.ordersHandler)
      // ensure permition to ordersHandler publish messages on sns topic
      ordersTopic.grantPublish(this.ordersHandler)

      const orderEventsHandler = new lambdaNodeJS.NodejsFunction(this, "OrderEventsFunction", {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: "OrderEventsFunction", 
        entry: "lambda/orders/orderEventsFunction.ts",
        handler: "handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(2),
        bundling: {
            minify: true,
            sourceMap: false
        },
        environment: {
            EVENTS_DDB: props.eventsDdb.tableName
        },
        layers: [orderEventsLayer, orderEventsRepositoryLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      })

      ordersTopic.addSubscription(new subs.LambdaSubscription(orderEventsHandler))

      const eventsDdbPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:PutItem"],
        resources: [props.eventsDdb.tableArn],
        conditions: {
          ["ForAllValues:StringLike"]: {
            "dynamodb:LeadingKeys": ["#order_*"]
          }
        }
      })

      orderEventsHandler.addToRolePolicy(eventsDdbPolicy)

      const billingHandler = new lambdaNodeJS.NodejsFunction(this, "BillingFunction", {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: "BillingFunction", 
        entry: "lambda/orders/billingFunction.ts",
        handler: "handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(2),
        bundling: {
            minify: true,
            sourceMap: false
        },
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      })
      
      ordersTopic.addSubscription(new subs.LambdaSubscription(billingHandler, {
        filterPolicy: {
          eventType: sns.SubscriptionFilter.stringFilter({
            allowlist: ['ORDER_CREATED']
          })
        }
      }))

      // @note dlq queue
      const orderEventsDLQ = new sqs.Queue(this, "OrderEventsDLQ", {
        queueName: "order-events-dlq",
        retentionPeriod: cdk.Duration.days(10),
        // @note only for development
        enforceSSL: false,
        encryption: sqs.QueueEncryption.UNENCRYPTED,
      })

      // @note: default queue
      const orderEventsQueue = new sqs.Queue(this, "OrderEventsQueue", {
        queueName: "order-events",
        deadLetterQueue: {
          maxReceiveCount: 3,
          queue: orderEventsDLQ
        },
        // @note only for development
        enforceSSL: false,
        encryption: sqs.QueueEncryption.UNENCRYPTED
      })

      ordersTopic.addSubscription(new subs.SqsSubscription(orderEventsQueue, {
        filterPolicy: {
          eventType: sns.SubscriptionFilter.stringFilter({
            allowlist: ['ORDER_CREATED']
          })
        }
      }))

      const orderEmailsHandler = new lambdaNodeJS.NodejsFunction(this, "OrderEmailsFunction", {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: "OrderEmailsFunction", 
        entry: "lambda/orders/orderEmailsFunction.ts",
        handler: "handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(2),
        bundling: {
            minify: true,
            sourceMap: false
        },
        layers: [orderEventsLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      })

      orderEmailsHandler.addEventSource(new lambdaEventSource.SqsEventSource(orderEventsQueue, {
        batchSize: 5,
        enabled: true,
        maxBatchingWindow: cdk.Duration.minutes(1)
      }))
      orderEventsQueue.grantConsumeMessages(orderEmailsHandler)
    }
}