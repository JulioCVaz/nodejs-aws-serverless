import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"

export class EventsDdbStack extends cdk.Stack {
    readonly table: dynamodb.Table

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        this.table = new dynamodb.Table(this, "EventsDdb", {
            tableName: "events",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            partitionKey: {
                name: "pk",
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: "sk",
                type: dynamodb.AttributeType.STRING,
            },
            timeToLiveAttribute: "ttl",
            // NOTE: CHECK ##nice to know - on-demand mode
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
            // provisioned mode
            // billingMode: dynamodb.BillingMode.PROVISIONED,
            // readCapacity: 1,
            // writeCapacity: 1
        })

        // NOTE: to enable provisioned configuration - RCU(read) and WCU(write) capacity of table operations in database

        // const readScale = this.table.autoScaleReadCapacity({
        //     maxCapacity: 2,
        //     minCapacity: 1
        // })

        // const duration = cdk.Duration.seconds(60)

        // readScale.scaleOnUtilization({
        //     targetUtilizationPercent: 50,
        //     scaleInCooldown: duration,
        //     scaleOutCooldown: duration
        // })

        // const writeScale = this.table.autoScaleWriteCapacity({
        //     maxCapacity: 4,
        //     minCapacity: 1
        // })

        // writeScale.scaleOnUtilization({
        //     targetUtilizationPercent: 30,
        //     scaleInCooldown: duration,
        //     scaleOutCooldown: duration
        // })
    }
}