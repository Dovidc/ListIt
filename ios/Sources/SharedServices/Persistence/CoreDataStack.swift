import Foundation
import CoreData

public final class CoreDataStack {
    public enum StackError: Error {
        case storeInitializationFailed(Error)
    }

    public let container: NSPersistentContainer

    public init(name: String = "ListItCache", inMemory: Bool = false) throws {
        let model = Self.makeModel()
        container = NSPersistentContainer(name: name, managedObjectModel: model)
        if inMemory {
            let description = NSPersistentStoreDescription()
            description.type = NSInMemoryStoreType
            container.persistentStoreDescriptions = [description]
        }

        var initializationError: Error?
        container.loadPersistentStores { _, error in
            if let error {
                initializationError = error
            }
        }

        if let initializationError {
            throw StackError.storeInitializationFailed(initializationError)
        }

        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
        container.viewContext.automaticallyMergesChangesFromParent = true
    }

    public func newBackgroundContext() -> NSManagedObjectContext {
        container.newBackgroundContext()
    }

    private static func makeModel() -> NSManagedObjectModel {
        let model = NSManagedObjectModel()

        let entity = NSEntityDescription()
        entity.name = "CachedListing"
        entity.managedObjectClassName = NSStringFromClass(CachedListing.self)

        let idAttribute = NSAttributeDescription()
        idAttribute.name = "id"
        idAttribute.attributeType = .stringAttributeType
        idAttribute.isOptional = false

        let titleAttribute = NSAttributeDescription()
        titleAttribute.name = "title"
        titleAttribute.attributeType = .stringAttributeType
        titleAttribute.isOptional = false

        let subtitleAttribute = NSAttributeDescription()
        subtitleAttribute.name = "subtitle"
        subtitleAttribute.attributeType = .stringAttributeType
        subtitleAttribute.isOptional = true

        let locationAttribute = NSAttributeDescription()
        locationAttribute.name = "location"
        locationAttribute.attributeType = .stringAttributeType
        locationAttribute.isOptional = true

        let priceAttribute = NSAttributeDescription()
        priceAttribute.name = "price"
        priceAttribute.attributeType = .doubleAttributeType
        priceAttribute.isOptional = true

        let updatedAtAttribute = NSAttributeDescription()
        updatedAtAttribute.name = "updatedAt"
        updatedAtAttribute.attributeType = .dateAttributeType
        updatedAtAttribute.isOptional = false

        entity.properties = [idAttribute, titleAttribute, subtitleAttribute, locationAttribute, priceAttribute, updatedAtAttribute]
        entity.uniquenessConstraints = [["id"]]

        model.entities = [entity]
        return model
    }
}

public protocol ListingsPersisting {
    func store(listings: [ListingSummary]) throws
    func loadListings() throws -> [ListingSummary]
    func clear() throws
}

public final class CoreDataListingsPersistence: ListingsPersisting {
    private let context: NSManagedObjectContext

    public init(stack: CoreDataStack? = nil) {
        self.context = CoreDataListingsPersistence.resolveContext(from: stack)
    }

    public func store(listings: [ListingSummary]) throws {
        var thrownError: Error?
        context.performAndWait {
            do {
                try self.clearInternal()
                let now = Date()
                for listing in listings {
                    let cached = CachedListing(context: context)
                    cached.id = listing.id
                    cached.title = listing.title
                    cached.subtitle = listing.subtitle
                    cached.location = listing.location
                    if let price = listing.price {
                        cached.price = NSNumber(value: price)
                    } else {
                        cached.price = nil
                    }
                    cached.updatedAt = now
                }
                if context.hasChanges {
                    try context.save()
                }
            } catch {
                thrownError = error
            }
        }
        if let thrownError { throw thrownError }
    }

    public func loadListings() throws -> [ListingSummary] {
        var results: [ListingSummary] = []
        var thrownError: Error?
        context.performAndWait {
            do {
                let request: NSFetchRequest<CachedListing> = CachedListing.fetchRequest()
                request.sortDescriptors = [NSSortDescriptor(key: #keyPath(CachedListing.updatedAt), ascending: false)]
                let fetched = try context.fetch(request)
                results = fetched.map {
                    let priceValue = $0.price?.doubleValue
                    return ListingSummary(
                        id: $0.id,
                        title: $0.title,
                        subtitle: $0.subtitle ?? "",
                        price: priceValue,
                        location: $0.location
                    )
                }
            } catch {
                thrownError = error
            }
        }
        if let thrownError { throw thrownError }
        return results
    }

    public func clear() throws {
        var thrownError: Error?
        context.performAndWait {
            do {
                try self.clearInternal()
                if context.hasChanges {
                    try context.save()
                }
            } catch {
                thrownError = error
            }
        }
        if let thrownError { throw thrownError }
    }

    private func clearInternal() throws {
        let fetchRequest: NSFetchRequest<NSFetchRequestResult> = CachedListing.fetchRequest()
        let deleteRequest = NSBatchDeleteRequest(fetchRequest: fetchRequest)
        deleteRequest.resultType = .resultTypeObjectIDs
        let result = try context.execute(deleteRequest) as? NSBatchDeleteResult
        if let objectIDs = result?.result as? [NSManagedObjectID], !objectIDs.isEmpty {
            let changes: [AnyHashable: Any] = [NSDeletedObjectsKey: objectIDs]
            NSManagedObjectContext.mergeChanges(fromRemoteContextSave: changes, into: [context])
        }
    }
}

private extension CoreDataListingsPersistence {
    static func resolveContext(from stack: CoreDataStack?) -> NSManagedObjectContext {
        if let stack {
            return stack.container.viewContext
        }
        if let stack = try? CoreDataStack() {
            return stack.container.viewContext
        }
        if let fallback = try? CoreDataStack(inMemory: true) {
            return fallback.container.viewContext
        }
        fatalError("Unable to create Core Data stack for listings persistence")
    }
}
